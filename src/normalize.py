#!/usr/bin/env python3

import argparse
import pandas as pd
import sys

def main():
    p = argparse.ArgumentParser(description="Normalize a numeric CSV column to [0,1].")
    p.add_argument("-i", "--input", required=True, help="Input CSV file")
    p.add_argument("-o", "--output", required=True, help="Output CSV file")
    p.add_argument("-c", "--column", required=True, help="Column name to normalize")
    args = p.parse_args()

    df = pd.read_csv(args.input)
    col = args.column
    if col not in df.columns:
        sys.exit(f"Column '{col}' not found in input CSV.")

    numeric = pd.to_numeric(df[col], errors="coerce")

    minv = numeric.min()
    maxv = numeric.max()

    if pd.isna(minv) or pd.isna(maxv):
        print("No numeric values found in the specified column; writing original file.")
        df.to_csv(args.output, index=False)
        return

    if maxv == minv:
        df.loc[numeric.notna(), col] = 0.0
    else:
        normalized = (numeric - minv) / (maxv - minv)
        df.loc[numeric.notna(), col] = normalized[numeric.notna()]

    df.to_csv(args.output, index=False)
    print("Normalization complete.")

if __name__ == "__main__":
    main()
