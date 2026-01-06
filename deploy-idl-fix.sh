#!/bin/bash
# Quick script to deploy IDL fix
cd "$(dirname "$0")"
git add src/app/api/solana/idl/route.ts
git commit -m "fix: use dynamic import for Solana IDL route to fix 404"
git push origin HEAD:main
echo "Done! Wait ~90 seconds for Vercel deployment"
