# Usar una imagen oficial de Node.js
FROM node:18-alpine

# Crear directorio de la app
WORKDIR /usr/src/app

# Copiar package.json y package-lock.json
COPY package*.json ./

# Instalar dependencias
RUN npm install

# Copiar el resto del código de la app
COPY . .

# Exponer el puerto
EXPOSE 5000

# Comando para correr la app
CMD [ "npm", "start" ]