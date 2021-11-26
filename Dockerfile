FROM node:12-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY ["package.json", "yarn.lock", "./"]
RUN yarn
COPY . .
EXPOSE 4000
CMD ["node", "src/index.js"]