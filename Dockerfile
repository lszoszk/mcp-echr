FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV PORT=8007 HOST=0.0.0.0
EXPOSE 8007
USER node
CMD ["node", "src/http.js"]
