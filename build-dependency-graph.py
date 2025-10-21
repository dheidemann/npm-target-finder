#!/usr/bin/env python3

import csv
import argparse
import networkx as nx

def add_nodes_to_graph(g: nx.DiGraph, csv_path):
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row["pkg_name"]
            if not name:
                # skip incomplete rows
                continue

            maintainer_count = int(row["maintainer_count"])
            avg_daily = int(row["avg_daily"])
            g.add_node(name, maintainer_count=maintainer_count, avg_daily=avg_daily)

def add_edges_to_graph(g: nx.DiGraph, csv_path):
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            source = row["source_pkg"]
            target = row["target_pkg"]
            if not source or not target:
                # skip incomplete rows
                continue

            g.add_edge(source, target)

def main():
    parser = argparse.ArgumentParser(description="Build a NetworkX graph from npm package names and dependency relations.")
    parser.add_argument("--edges", "-e", help="Path to flattened CSV file for dependencies (source_pkg,target_pkg,maintainer_count,avg_daily).")
    parser.add_argument("--nodes", "-n", help="Path to CSV file to build nodes (pkg_name,maintainer_count,avg_daily).")
    parser.add_argument("--out", "-o", default="graph", help="Output graph file name.")
    parser.add_argument("--format", "-f", default="gexf", help="Output graph format.")
    args = parser.parse_args()

    print("Reading CSV and building graph...")
    G = nx.DiGraph()
    add_nodes_to_graph(G, args.nodes)
    add_edges_to_graph(G, args.edges)
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
