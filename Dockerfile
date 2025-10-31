FROM node:lts-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 8080
CMD [ "node", "server/index.js" ]
LABEL org.opencontainers.image.source="https://github.com/Niek/obs-web"
