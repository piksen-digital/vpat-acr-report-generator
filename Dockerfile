FROM apify/actor-node-playwright-chrome:22-1.52.0

COPY --chown=myuser:myuser package*.json ./

RUN npm --quiet set progress=false \
 && npm install --include=dev \
 && echo "Installed NPM packages:" \
 && (npm list --all || true)

COPY --chown=myuser:myuser . ./

RUN npm run build \
 && npm prune --omit=dev

CMD npm run start:prod --silent
