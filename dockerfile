FROM node:22-alpine

WORKDIR /app

# Force sharp to use pre-compiled binaries instead of compiling C++ source code inside Alpine
ENV SHARP_IGNORE_GLOBAL_LIBVIPS=1
ENV npm_config_architecture=x64
ENV npm_config_platform=linux
ENV npm_config_libc=musl

# FIX: Set the exact API registry mirror endpoint
RUN npm config set registry https://registry.npmmirror.com/
RUN npm config set fetch-retry-maxtimeout 60000
RUN npm config set fetch-retries 5

COPY package*.json ./

# Speed up dependency installation by skipping progress tickers and audits
RUN npm install --prefer-offline --no-audit --no-fund --progress=false

COPY . .

RUN npx prisma generate

EXPOSE 5000

CMD ["npm", "run", "dev"]
