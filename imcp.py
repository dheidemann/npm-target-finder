import networkx as nx
import random
import heapq
import math
import multiprocessing as mp
import os
from functools import partial

try:
    from tqdm import tqdm
    TQDM = True
except Exception:
    TQDM = False


# ------------------------- graph conversion -------------------------

def build_light_graph(G):
    """Convert a networkx graph to lightweight adjacency and weight dicts.

    Returns:
      adj: dict[node] -> list(neighbors)
      weights: dict[node] -> float (node-level activation prob)
      is_directed: bool
    """
    is_directed = G.is_directed()
    adj = {}
    weights = {}

    if is_directed:
        out_neighbors = G.succ
    else:
        out_neighbors = G.adj

    for n in G.nodes():
        # neighbors as a list for fast iteration
        nbrs = list(out_neighbors[n].keys())
        adj[n] = nbrs
        # node-level weight attribute; fallback to None (user will pass default_p)
        weights[n] = G.nodes[n].get('weight', None)

    return adj, weights, is_directed


# ------------------------- IC simulation (lightweight) -------------------------

def run_ic_light(adj, weights, seeds, default_p=0.01, steps=None, rand=None):
    """Run a single IC simulation on lightweight graph structures.

    - adj: dict[node] -> list(neighbors)
    - weights: dict[node] -> float or None
    - seeds: iterable of seed nodes
    - default_p: fallback activation probability when node has no weight
    - steps: max steps (None => until no new activations)
    - rand: instance of random.Random (optional, faster than global random)

    Returns: size of final active set (int)
    """
    if rand is None:
        rand = random

    active = set(seeds)
    newly_active = set(seeds)
    step = 0

    while newly_active:
        if steps is not None and step >= steps:
            break
        step += 1
        next_active = set()
        for u in newly_active:
            node_p = weights.get(u, None)
            if node_p is None:
                node_p = default_p
            # iterate neighbors
            for v in adj.get(u, ()):  # empty tuple if u not in adj
                if v in active:
                    continue
                if rand.random() <= node_p:
                    next_active.add(v)
        # newly activated are those not already active
        newly_active = next_active - active
        active |= newly_active
    return len(active)


# ------------------------- multiprocessing helpers -------------------------

def _mc_worker_batch(adj, weights, seeds, default_p, steps, batch_size, seed_offset):
    """Worker that runs `batch_size` IC simulations and returns total spread sum.
    seed_offset is an integer used to vary RNG seed per worker call for diversity.
    This function is designed to be picklable for multiprocessing.
    """
    # Create a local RNG seeded uniquely
    rng = random.Random()
    rng.seed((os.getpid() << 32) ^ seed_offset ^ int.from_bytes(os.urandom(4), 'little'))

    total = 0
    for i in range(batch_size):
        total += run_ic_light(adj, weights, seeds, default_p=default_p, steps=steps, rand=rng)
    return total


def mc_spread_parallel(adj, weights, seeds, default_p=0.01, mc=100, steps=None, processes=None, chunksize=1, show_progress=False):
    """Estimate expected spread using parallel Monte Carlo.

    - adj, weights: lightweight graph
    - seeds: set or iterable of seeds
    - mc: total number of independent simulations
    - processes: number of worker processes (None -> cpu_count())
    - chunksize: how many simulations per worker task (controls IPC overhead). If None, auto-chosen.
    - show_progress: if True and tqdm available, show progress bar.

    Returns: float (average spread)
    """
    if mc <= 0:
        return 0.0

    if processes is None:
        processes = max(1, mp.cpu_count() - 1)

    # Choose batch size to reduce IPC overhead: aim for ~4*processes tasks
    if chunksize is None:
        chunksize = max(1, mc // (4 * processes))

    # Build list of batch sizes that sum to mc
    batches = []
    remaining = mc
    seed_offset = 0
    while remaining > 0:
        b = min(chunksize, remaining)
        batches.append((b, seed_offset))
        remaining -= b
        seed_offset += 1

    # Prepare partial worker with read-only graph data
    worker_partial = partial(_mc_worker_batch, adj, weights, set(seeds), default_p, steps)

    total = 0
    if processes == 1:
        # run inline (no multiprocessing) - useful for debugging
        if show_progress and TQDM:
            iterator = tqdm(batches, desc='mc batches')
        else:
            iterator = batches
        for b, offset in iterator:
            total += worker_partial(b, offset)
    else:
        with mp.Pool(processes=processes) as pool:
            if show_progress and TQDM:
                results = pool.istarmap(worker_partial, batches)
                for r in tqdm(results, total=len(batches), desc='mc batches'):
                    total += r
            else:
                results = pool.starmap(worker_partial, batches)
                total = sum(results)

    return float(total) / float(mc)


# ------------------------- candidate pruning -------------------------

def top_candidates_by_score(G, M=1000):
    """Return top-M nodes by heuristic score: out_degree * node_weight

    Uses heapq.nlargest to avoid full sorting of all nodes if M << N.
    """
    is_directed = G.is_directed()

    def score(n):
        w = G.nodes[n].get('weight', 1.0)
        deg = G.out_degree(n) if is_directed else G.degree(n)
        return w * deg

    # heapq.nlargest handles generator efficiently
    return heapq.nlargest(M, G.nodes(), key=score)


# ------------------------- CELF (pruned) -------------------------

def celf_pruned(G, k, default_p=0.01, mc=100, M=2000, processes=None, chunksize=None, steps=None, show_progress=False):
    """CELF greedy influence maximization over a pruned candidate set.

    Parameters
    - G: networkx Graph or DiGraph (node-level 'weight' attr used)
    - k: number of seeds to select
    - default_p: fallback activation probability for nodes without 'weight'
    - mc: number of Monte Carlo simulations to estimate spread/marginal gains
    - M: number of top candidates to consider (pruning parameter)
    - processes: number of processes for parallel MC (None -> cpu_count()-1)
    - chunksize: batch size for mc worker batching (None -> auto)
    - steps: max diffusion steps in IC (None -> until convergence)
    - show_progress: whether to show tqdm progress bars (if available)

    Returns: list of selected seed nodes
    """
    if k <= 0:
        return []

    # Build lightweight graph once
    adj, weights, is_directed = build_light_graph(G)

    # Candidate selection
    if M <= 0:
        raise ValueError('M (candidate count) must be > 0')

    # If M >= number of nodes, just use all nodes
    if M >= G.number_of_nodes():
        candidates = list(G.nodes())
    else:
        candidates = top_candidates_by_score(G, M)

    # Precompute initial marginal gains for candidates (parallelizable)
    pq = []  # max-heap via (-gain, node, last_updated_round)

    if show_progress and TQDM:
        iterable = (tqdm(candidates, desc='init candidates') )
    else:
        iterable = candidates

    # For speed, compute spreads per candidate in parallel by reusing mc_spread_parallel per node
    # We parallelize across candidates by running mc_spread_parallel with processes=1 but launching
    # multiple processes at upper level would require more complex orchestration. Simpler: compute
    # each candidate sequentially but each call uses parallel MC internally.

    for node in iterable:
        gain = mc_spread_parallel(adj, weights, {node}, default_p=default_p, mc=mc, steps=steps, processes=processes, chunksize=chunksize, show_progress=False)
        heapq.heappush(pq, (-gain, node, 0))

    seeds = []
    selected_round = 1

    # current_spread cached to avoid recomputation every time
    current_spread = 0.0

    # CELF loop
    while len(seeds) < k and pq:
        neg_gain, node, last_round = heapq.heappop(pq)
        candidate_gain = -neg_gain

        if last_round == selected_round - 1:
            # gain is up-to-date relative to current seeds; accept node
            seeds.append(node)
            current_spread += candidate_gain
            selected_round += 1
        else:
            # recompute marginal gain w.r.t. current seeds
            base = mc_spread_parallel(adj, weights, set(seeds), default_p=default_p, mc=mc, steps=steps, processes=processes, chunksize=chunksize, show_progress=False) if seeds else 0.0
            new_spread = mc_spread_parallel(adj, weights, set(seeds) | {node}, default_p=default_p, mc=mc, steps=steps, processes=processes, chunksize=chunksize, show_progress=False)
            marginal = new_spread - base
            heapq.heappush(pq, (-marginal, node, selected_round - 1))

    return seeds


# ------------------------- convenience evaluation -------------------------

def evaluate_spread(G, seeds, default_p=0.01, mc=1000, processes=None, chunksize=None, steps=None, show_progress=False):
    """Evaluate final expected spread of a seed set using parallel MC.

    Returns float (expected spread).
    """
    adj, weights, _ = build_light_graph(G)
    return mc_spread_parallel(adj, weights, set(seeds), default_p=default_p, mc=mc, steps=steps, processes=processes, chunksize=chunksize, show_progress=show_progress)


# ------------------------- example / main -------------------------
if __name__ == '__main__':
    # small usage example with a synthetic graph
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument('--k', type=int, default=10)
    parser.add_argument('--M', type=int, default=500)
    parser.add_argument('--mc', type=int, default=200)
    parser.add_argument('--processes', type=int, default=None)
    parser.add_argument('--reverse', action="store_true")
    parser.add_argument("filepath")
    args = parser.parse_args()

    G = nx.read_gexf(args.filepath)

    if args.reverse: G = G.reverse()

    print(f"Successfully read graph with {G.number_of_nodes()} nodes and {G.number_of_edges()} edges.")

    print('Running celf_pruned on synthetic graph...')
    seeds = celf_pruned(G, k=args.k, default_p=0.01, mc=args.mc, M=args.M, processes=args.processes, show_progress=True)
    print('Selected seeds:', seeds)

    est = evaluate_spread(G, seeds, default_p=0.01, mc=1000, processes=args.processes, show_progress=True)
    print('Estimated spread (mc=1000):', est)
