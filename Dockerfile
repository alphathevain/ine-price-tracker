# Official Playwright image — Chromium + all system libraries already installed.
# The version tag MUST match the "playwright" version in package.json.
FROM mcr.microsoft.com/playwright:v1.47.0-jammy

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json ./
RUN npm install

# Copy the rest of the backend source
COPY . .

# Render sets $PORT itself; the app already reads process.env.PORT
EXPOSE 4000

CMD ["npm", "start"]
