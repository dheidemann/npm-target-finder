#!/usr/bin/env python3

import csv
import argparse

parser = argparse.ArgumentParser(description="Calculate atackability scores.")
parser.add_argument("-i", help="Path to packages file")
parser.add_argument("-o", help="Output file")
args = parser.parse_args()

input_file = args.i
output_file = args.o

with open(input_file, newline="", encoding="utf-8") as infile, \
     open(output_file, "w", newline="", encoding="utf-8") as outfile:
    
    reader = csv.DictReader(infile)
    writer = csv.writer(outfile)
    
    writer.writerow(["source_pkg", "target_pkg", "maintainer_count", "avg_daily"])
    
    for row in reader:
        source_pkg = row["pkg_name"]
        maintainer_count = row["maintainer_count"]
        avg_daily = row["avg_daily"]
        deps = row["dependencies"]
        dependencies = deps.split("$")
        
        for dep in dependencies:
            writer.writerow([source_pkg, dep, maintainer_count, avg_daily])

print(f"Flattened dependencies written to: {output_file}")
