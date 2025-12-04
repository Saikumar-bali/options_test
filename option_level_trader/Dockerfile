# Use a lightweight Node.js image
FROM node:18-alpine

# Create and set working directory
WORKDIR /usr/src/app

# Copy package files and install dependencies FIRST (for better cache)
COPY package*.json ./
RUN npm ci --only=production

# Copy ALL application source code
COPY . .

# Start the application using the command from your package.json
CMD ["npm", "start"]