FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    NODE_OPTIONS=--disable-proto=throw \
    SUPPRESOR_GATE_PORT=8787

COPY refusal-patterns.mjs ./refusal-patterns.mjs
COPY server/gate.mjs ./server/gate.mjs
COPY server/token-key-public.pem server/license-public.pem ./server/

RUN addgroup -S gate && adduser -S gate -G gate && chown -R gate:gate /app
USER gate

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1

CMD ["node", "server/gate.mjs"]
