FROM node:20-alpine
WORKDIR /app
# bring in package manifest first for better layer caching
COPY package.json package-lock.json* ./
RUN npm ci || npm i --production
# then bring the rest
COPY . .
# default port picked up from env (with a fallback)
ENV PORT=8080
EXPOSE 8080
CMD ["node","index.js"]
