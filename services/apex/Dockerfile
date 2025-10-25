FROM node:20-alpine
RUN apk add --no-cache git openssh-client
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm i --production
COPY . .
ENV PORT=8082
EXPOSE 8082
CMD ["node","index.js"]
