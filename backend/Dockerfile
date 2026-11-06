# Build
FROM maven:3.9.16-eclipse-temurin-17-alpine AS build
WORKDIR /src
COPY pom.xml .
RUN mvn -B -q dependency:go-offline
COPY src ./src
RUN mvn -B -q package -DskipTests && cp target/estrella-api-*.jar /src/app.jar

# Run: JRE only, non-root, small heap for free-tier instances
FROM eclipse-temurin:17.0.21_9-jre-alpine-3.24
RUN addgroup -S app && adduser -S -G app -H app
WORKDIR /app
COPY --from=build --chown=app:app /src/app.jar app.jar
USER app
EXPOSE 8080
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=70 -XX:+UseSerialGC -XX:TieredStopAtLevel=1 -Xss512k"
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/actuator/health | grep -q '"UP"' || exit 1
ENTRYPOINT ["java", "-jar", "app.jar"]
