FROM node:22-alpine

WORKDIR /usr/src/app

COPY package.json package-lock.json ./
# Lockfile is written by npm 11. The Node 22 image ships npm 10, which rejects it.
RUN npm install -g npm@11.12.1 && npm ci --omit=dev && npm cache clean --force

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node
CMD ["node", "src/index.js"]
