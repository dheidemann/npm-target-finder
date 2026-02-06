#!/usr/bin/env python3

import csv
import argparse
import networkx as nx

def add_nodes_to_graph(g: nx.DiGraph, csv_path, min_avg_daily):
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row.get("pkg_name")
            if not name:
                continue

            attrs = {}

            for key, value in row.items():
                if key == "pkg_name":
                    continue
                if value is None or value == "":
                    continue

                try:
                    if "." in value:
                        coerced = float(value)
                    else:
                        coerced = int(value)
                except ValueError:
                    coerced = value

                attrs[key] = coerced

            avg_daily = attrs.get("avg_daily", 0)
            try:
                avg_daily = int(float(avg_daily))
            except (ValueError, TypeError):
                avg_daily = 0

            if avg_daily >= min_avg_daily:
                g.add_node(name, **attrs)

def add_edges_to_graph(g: nx.DiGraph, csv_path, reverse):
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            source = row["source_pkg"]
            target = row["target_pkg"]
            if not source or not target:
                # skip incomplete rows
                continue

            if source in g and target in g:
                if reverse: g.add_edge(target, source)
                else: g.add_edge(source, target)

def main():
    parser = argparse.ArgumentParser(description="Build a NetworkX graph from npm package names and dependency relations.")
    parser.add_argument("--edges", "-e", help="Path to flattened CSV file for dependencies (source_pkg,target_pkg,maintainer_count,avg_daily).")
    parser.add_argument("--nodes", "-n", help="Path to CSV file to build nodes (pkg_name,maintainer_count,avg_daily).")
    parser.add_argument("--out", "-o", default="graph", help="Output graph file name.")
    parser.add_argument("--format", "-f", default="gexf", help="Output graph format.")
    parser.add_argument("--min_avg_daily", type=int, default=0)
    parser.add_argument('--reverse', action="store_true")
    args = parser.parse_args()

    print("Reading CSV and building graph...")
    G = nx.DiGraph()
    add_nodes_to_graph(G, args.nodes, args.min_avg_daily)
    add_edges_to_graph(G, args.edges, args.reverse)
    print(f"Built graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges.")

    out_path = args.out
    if args.format == "gexf":
        if not out_path.lower().endswith(".gexf"):
            out_path = out_path + ".gexf"
        nx.write_gexf(G, out_path)
    elif args.format == "graphml":
        if not out_path.lower().endswith(".graphml"):
            out_path = out_path + ".graphml"
        nx.write_graphml(G, out_path)
    elif args.format == "dot":
        if not out_path.lower().endswith(".dot"):
            out_path = out_path + ".dot"
        nx.nx_agraph.write_dot(G, out_path)

    print(f"Saved graph to: {out_path}")

if __name__ == "__main__":
    main()
