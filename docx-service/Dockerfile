FROM node:22-alpine

# Install LibreOffice Writer for high-fidelity DOCX -> PDF conversion and fonts
RUN apk add --no-cache \
    libreoffice-writer \
    ttf-freefont \
    font-noto \
    wget \
    ca-certificates

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

RUN mkdir -p /data/resumes && chown -R node:node /data/resumes /app

USER node

EXPOSE 3001

CMD ["node", "src/server.js"]
