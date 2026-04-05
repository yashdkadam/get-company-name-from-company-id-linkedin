# Use Apify Playwright image
FROM apify/actor-node-playwright-chrome:20

# Switch to root to install deps
USER root

# Set working directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev --no-audit --no-fund

# Copy rest of code
COPY . ./

# Fix ownership so non-root user can access files
RUN chown -R myuser:myuser /usr/src/app

# Switch back to non-root (important for Apify)
USER myuser

# Run actor
CMD ["npm", "start"]