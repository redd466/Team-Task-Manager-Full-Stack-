FROM node:20-alpine

WORKDIR /app

COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/

RUN npm ci --prefix backend
RUN npm ci --prefix frontend

COPY . .

RUN npm --prefix frontend run build

ENV NODE_ENV=production
EXPOSE 5000

CMD ["node", "backend/app.js"]
