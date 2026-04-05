# Use Apify base image with Node.js + Playwright support
FROM apify/actor-node-playwright-chrome:20

# Set working directory
WORKDIR /usr/src/app

# Copy package files first (better caching)
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev --no-audit --no-fund

# Copy the rest of the source code
COPY . ./

# Build step (if needed in future)
# RUN npm run build

# Run the actor
CMD ["npm", "start"]