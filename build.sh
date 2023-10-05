#!/bin/bash

if [[ $VERCEL_ENV == "preview"  ]] ; then
  echo "Creating preview deployment!"
	export VITE_CONVEX_URL=$(npx convex preview $VERCEL_GIT_COMMIT_REF) && npm run build
elif [[ $VERCEL_ENV == "prod" ]]; then
  npm run build && npx convex deploy
else
	# Command for dev if relevant
	echo "No dev command"
fi