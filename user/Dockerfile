FROM robotshopdevacr.azurecr.io/baseimages/node:25-slim-internal

WORKDIR /opt/server

COPY package.json /opt/server/

RUN npm install

COPY src/server.js /opt/server/

CMD ["node", "server.js"]