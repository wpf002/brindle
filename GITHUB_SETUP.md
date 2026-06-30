# Push to GitHub

```bash
# create an empty repo named "brindle" on GitHub first (no README/license)
git init
git add .
git commit -m "chore: scaffold brindle monorepo"
git branch -M main
git remote add origin git@github.com:wpf002/brindle.git
git push -u origin main
```
