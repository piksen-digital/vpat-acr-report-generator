FROM apify/actor-node-playwright-chrome:22-1.52.0

COPY --chown=myuser:myuser package*.json ./

RUN npm --quiet set progress=false \
 && npm install \
 && echo "Installed NPM packages:" \
 && (npm list --all || true)

COPY --chown=myuser:myuser . ./

CMD npm run start:dev --silent