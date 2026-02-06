import argparse
import pandas as pd
from pathlib import Path
from functools import reduce

def merge_csvs(identifier, paths_string, output, sort_by):
    paths = [p.strip() for p in paths_string.replace(",", " ").split()]
    dataframes = []

    for path in paths:
        csv_path = Path(path)

        if not csv_path.exists():
            raise FileNotFoundError(f"{csv_path} does not exist")

        df = pd.read_csv(csv_path)

        if identifier not in df.columns:
            raise ValueError(f"'{identifier}' not found in {csv_path}")

        dataframes.append(df)

    if len(dataframes) < 2:
        raise ValueError("At least two CSV files are required to merge")

    merged_df = reduce(
        lambda left, right: pd.merge(
            left,
            right,
            on=identifier,
            how="outer"
        ),
        dataframes
    )

    if sort_by:
        merged_df.sort_values(
            by=sort_by,
            ascending=False,
            inplace=True
        )

    merged_df.to_csv(output, index=False)
    print(f"Merged CSV written to: {output}")

def main():
    parser = argparse.ArgumentParser(description="Merge CSV files on an identifier column")
    parser.add_argument("--identifier", required=True, help="Identifier column (e.g. pkg_name)")
    parser.add_argument("--paths", required=True, help="CSV paths (comma or space separated)")
    parser.add_argument("--output", default="merged.csv", help="Output CSV file")
    parser.add_argument("--sort_by", help="Sort desc by identifier")

    args = parser.parse_args()
    merge_csvs(args.identifier, args.paths, args.output, args.sort_by)

if __name__ == "__main__":
    main()
