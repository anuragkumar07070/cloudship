/**
 * Generate a Dockerfile string for a service.
 * Never touches the original repo — caller writes into workspace copy.
 */
export function generateDockerfile(service, { hasLockfile }) {
  const installCmd = hasLockfile ? 'npm ci' : 'npm install';
  if (service.type === 'static-site') return staticSiteTemplate(service, installCmd);
  if (service.type === 'node-server') return nodeServerTemplate(service, installCmd);
  throw new Error(`No template for type "${service.type}"`);
}

function staticSiteTemplate(service, installCmd) {
  const buildCmd = service.buildCommand || 'npm run build';
  const outDir = service.outputDir || 'dist';
  // Build-time env vars exposed as ARG -> ENV for the build step.
  const argLines = (service.buildArgNames || []).map((n) => `ARG ${n}\nENV ${n}=$${n}`).join('\n');
  return `
# syntax=docker/dockerfile:1
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN ${installCmd}
COPY . .
${argLines}
RUN ${buildCmd}

FROM nginx:alpine
COPY --from=build /app/${outDir} /usr/share/nginx/html
COPY .cloudship-nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`.trimStart();
}

function nodeServerTemplate(service, installCmd) {
  const port = service.port;
  if (!port) throw new Error(`node-server "${service.name}" has no port`);
  const start = service.startCommand || 'npm start';
  return `
# syntax=docker/dockerfile:1
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN ${installCmd} --omit=dev
COPY . .
EXPOSE ${port}
CMD ${JSON.stringify(['sh', '-lc', start])}
`.trimStart();
}

export function staticSiteNginxConf() {
  return `
server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;
  location / {
    try_files $uri $uri/ /index.html;
  }
}
`.trimStart();
}