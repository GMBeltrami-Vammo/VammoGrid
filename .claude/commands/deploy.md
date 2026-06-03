Deploy the current branch to Vercel production.

Project: **vammo-grid** (`prj_SiD3fBNlvmcHW7032lQDKqgMXtJP`)
Team: `gmb-eltrami-s-projects` (`team_A3oOPFTXdqFFsch0Nk8rymcS`)
Region: `gru1` (São Paulo — colocated with metabase.vammo.com)
Production URL: https://vammo-grid.vercel.app

Steps:
1. Confirm the working tree is clean: `git status`
2. Push to main: `git push origin main`
3. Vercel auto-deploys on push via GitHub integration. Monitor with: `vercel logs`

To trigger a manual deploy without pushing:
```bash
vercel --prod
```

To check the latest deployment status, use the Vercel MCP tool `mcp__vercel__get_deployment` with the deployment ID from `mcp__vercel__list_deployments`.
