# Usar una imagen oficial de Node.js
FROM node:18-alpine

# Establecer el directorio de trabajo en la imagen
WORKDIR /usr/src/app

# Copiar primero package.json y package-lock.json para aprovechar el caché de Docker
COPY package*.json ./

# Instalar las dependencias del proyecto
RUN npm install

# Copiar TODO el resto del código fuente de la aplicación al directorio de trabajo
# Esto incluye index.js, la carpeta models/, etc.
COPY . .

# Exponer el puerto en el que corre la app
EXPOSE 5000

# El comando para iniciar la aplicación
CMD [ "npm", "start" ]