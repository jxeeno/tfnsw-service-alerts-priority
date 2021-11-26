FROM node:12-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY ["package.json", "yarn.lock", "./"]
RUN yarn
COPY . .
RUN yarn build
EXPOSE 4000
CMD ["yarn", "start"]