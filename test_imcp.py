# test_influence.py
import unittest
import random
import networkx as nx

# Import functions from your module. Adjust the import path as needed.
# e.g. if your implementation is in influence.py, do: from influence import run_ic_light, mc_spread_parallel, celf_pruned, evaluate_spread, build_light_graph
# For this test script assume file is named influence_impl.py
import importlib
import os
import sys

# adjust this name to the filename where your implementation is saved
MODULE_NAME = "imcp"

# add current dir to path so tests can import module located here
sys.path.insert(0, os.path.abspath("."))

impl = importlib.import_module(MODULE_NAME)

class TestInfluence(unittest.TestCase):

    def test_run_ic_light_deterministic_all_activate(self):
        # If node weights are 1.0, all reachable nodes should become active deterministically.
        G = nx.DiGraph()
        edges = [(1,2),(2,3),(3,4),(1,5)]
        G.add_edges_from(edges)
        for n in G.nodes():
            G.nodes[n]['weight'] = 1.0
        adj, weights, is_directed = impl.build_light_graph(G)
        spread = impl.run_ic_light(adj, weights, seeds=[1], default_p=0.01, steps=None, rand=random.Random(42))
        # nodes reachable from 1: {1,2,3,4,5} => size 5
        self.assertEqual(spread, 5)

    def test_run_ic_light_deterministic_none_activate(self):
        # If node weights are 0.0, no new node should be activated.
        G = nx.DiGraph()
        G.add_edges_from([(1,2),(2,3),(3,1)])
        for n in G.nodes():
            G.nodes[n]['weight'] = 0.0
        adj, weights, _ = impl.build_light_graph(G)
        spread = impl.run_ic_light(adj, weights, seeds=[1], default_p=0.01, steps=None, rand=random.Random(123))
        self.assertEqual(spread, 1)  # only seed active

    def test_mc_spread_parallel_single_process_matches_repeated(self):
        # Compare mc_spread_parallel (processes=1) to repeated run_ic_light calls with same RNG seeds
        G = nx.DiGraph()
        G.add_edges_from([(0,1),(0,2),(1,3),(2,4)])
        for n in G.nodes():
            G.nodes[n]['weight'] = 0.5
        adj, weights, _ = impl.build_light_graph(G)

        # compute expected average by repeated deterministic RNG runs (same seed sequence)
        rng = random.Random(42)
        trials = 200
        total = 0
        # run repeatedly with separate Random instances but seeded deterministically
        for i in range(trials):
            r = random.Random(1000 + i)
            total += impl.run_ic_light(adj, weights, [0], default_p=0.01, steps=None, rand=r)
        expected = total / float(trials)

        # now use mc_spread_parallel with processes=1 which runs inline
        approx = impl.mc_spread_parallel(adj, weights, {0}, default_p=0.01, mc=trials, steps=None, processes=1, chunksize=10, show_progress=False)

        # they won't be exactly equal because seed sequences differ, but should be close within reasonable tolerance
        self.assertAlmostEqual(approx, expected, delta=1.0)

    def test_celf_pruned_basic(self):
        # For deterministic weights=1.0 and k=1, the best seed is node with largest reachable set.
        G = nx.DiGraph()
        # Chain 1 -> 2 -> 3 and a star from 4 -> {5,6,7}
        G.add_edges_from([(1,2),(2,3),(4,5),(4,6),(4,7)])
        for n in G.nodes():
            G.nodes[n]['weight'] = 1.0
        seeds = impl.celf_pruned(G, k=1, default_p=0.01, mc=50, M=10, processes=1, chunksize=10, steps=None, show_progress=False)
        # Node 4 reaches three nodes (4,5,6,7) = 4 nodes, node 1 reaches 3 nodes
        self.assertEqual(len(seeds), 1)
        self.assertIn(seeds[0], {4})

    def test_evaluate_spread_consistency(self):
        # evaluate_spread should be roughly equal to calling mc_spread_parallel directly
        G = nx.Graph()
        G.add_edges_from([(0,1),(1,2),(2,3),(3,4)])
        for n in G.nodes():
            G.nodes[n]['weight'] = 0.5
        seeds = [0]
        est1 = impl.evaluate_spread(G, seeds, default_p=0.01, mc=200, processes=1, chunksize=20, steps=None, show_progress=False)
        adj, weights, _ = impl.build_light_graph(G)
        est2 = impl.mc_spread_parallel(adj, weights, set(seeds), default_p=0.01, mc=200, processes=1, chunksize=20, steps=None, show_progress=False)
        self.assertAlmostEqual(est1, est2, delta=1.0)

if __name__ == "__main__":
    unittest.main()
