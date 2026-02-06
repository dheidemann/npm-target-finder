#!/usr/bin/env python3

import argparse
import pandas as pd

p = argparse.ArgumentParser()
p.add_argument('-i', '--input', required=True)
p.add_argument('-o', '--output', required=True)
p.add_argument('-c', '--column', required=True)
p.add_argument('-l', '--labelcol', required=True)
p.add_argument('-top', '--top', type=int, required=True)
args = p.parse_args()

df = pd.read_csv(args.input)
new_col = f"{args.column}_label"
df[new_col] = ''

scores = pd.to_numeric(df[args.column], errors='coerce')
top_idx = scores.nlargest(args.top).index

df.loc[top_idx, new_col] = df.loc[top_idx, args.labelcol].astype(str)

df.to_csv(args.output, index=False)
print(f"Wrote {args.output} (added column '{new_col}').")
