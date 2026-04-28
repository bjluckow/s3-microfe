import boto3
import os
import sys
import zipfile
from io import BytesIO

AWS_ACCESS_KEY_ID = os.environ["AWS_ACCESS_KEY_ID"]
AWS_SECRET_ACCESS_KEY = os.environ["AWS_SECRET_ACCESS_KEY"]
AWS_REGION = os.environ["AWS_REGION"]
AWS_BUCKET_NAME = os.environ["AWS_BUCKET_NAME"]

s3 = boto3.client(
    "s3",
    aws_access_key_id=AWS_ACCESS_KEY_ID,
    aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
    region_name=AWS_REGION,
)

def list_keys(folder: str, recursive: bool) -> list[dict]:
    keys = []
    token = None
    prefix = f"{folder}/" if folder else ""

    while True:
        kwargs = {
            "Bucket": AWS_BUCKET_NAME,
            "Prefix": prefix,
        }
        if not recursive:
            kwargs["Delimiter"] = "/"
        if token:
            kwargs["ContinuationToken"] = token

        res = s3.list_objects_v2(**kwargs)
        keys.extend(res.get("Contents", []))
        token = res.get("NextContinuationToken")
        if not token:
            break

    return keys

def export(folder: str, recursive: bool, output: str):
    print(f"Listing files in '{folder}'...")
    objects = list_keys(folder, recursive)

    if not objects:
        print("No files found.")
        return

    total = len(objects)
    print(f"Found {total} files. Starting export to {output}...")

    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as zf:
        for i, obj in enumerate(objects, 1):
            key = obj["Key"]
            size_mb = obj["Size"] / 1024 / 1024
            filename = key[len(folder):].lstrip("/") if folder else key

            print(f"[{i}/{total}] {filename} ({size_mb:.1f} MB)")

            response = s3.get_object(Bucket=AWS_BUCKET_NAME, Key=key)
            zf.writestr(filename, response["Body"].read())

    print(f"\n✓ Exported {total} files to {output}")

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Export S3 folder to zip")
    parser.add_argument("folder", help="S3 folder prefix to export")
    parser.add_argument("--recursive", action="store_true", help="Include subfolders")
    parser.add_argument("--output", default=None, help="Output zip filename")

    args = parser.parse_args()
    output = args.output or f"{args.folder.replace('/', '-')}-export.zip"

    export(args.folder, args.recursive, output)