/**
 * Runtime overlay prompts — help the AI understand the SOURCE CODE language.
 * Tests are ALWAYS written in Node.js (see basePrompt.ts).
 * These overlays help the AI read and understand routes/endpoints in different frameworks.
 */
export function getOverlayPrompt(runtime: string): string {
    switch (runtime) {
        case "node":
            return `
SOURCE CODE CONTEXT: Node.js / TypeScript
- Look for Express routes: app.get(), app.post(), router.get(), router.post()
- Check middleware: app.use(), router.use() (auth, validation, error handling)
- Entry point: typically index.js, app.js, or server.js
- Route files: often in routes/, controllers/, or api/ directories
- Auth patterns: passport, jsonwebtoken, express-jwt, cookie-session
- For Node.js repos, import the app/router directly in your test file`;

        case "python":
            return `
SOURCE CODE CONTEXT: Python
- FastAPI routes: @app.get(), @app.post(), @router.get()
- Flask routes: @app.route(), @blueprint.route()
- Django routes: urlpatterns in urls.py, views in views.py
- Entry point: main.py, app.py, or manage.py (Django)
- Auth: FastAPI dependencies, Flask-Login, Django auth middleware
- To test: start the server first, then run Node.js HTTP tests against it
  Example server start: "python -m uvicorn main:app --host 0.0.0.0 --port 3001"`;

        case "go":
            return `
SOURCE CODE CONTEXT: Go
- Standard library: http.HandleFunc(), http.Handle()
- Gin routes: r.GET(), r.POST(), router.Group()
- Chi routes: r.Get(), r.Post(), r.Route()
- Echo routes: e.GET(), e.POST()
- Entry point: main.go or cmd/server/main.go
- To test: start the server first, then run Node.js HTTP tests against it
  Example server start: "go run ." or "go run main.go"`;

        case "rust":
            return `
SOURCE CODE CONTEXT: Rust
- Actix-web routes: web::resource(), web::scope(), HttpServer::new()
- Rocket routes: #[get()], #[post()], routes![]
- Axum routes: Router::new().route()
- Entry point: main.rs or src/main.rs
- To test: build and start server, then run Node.js HTTP tests`;

        case "java":
            return `
SOURCE CODE CONTEXT: Java
- Spring Boot: @GetMapping, @PostMapping, @RestController
- JAX-RS: @GET, @POST, @Path
- Entry point: Application.java with @SpringBootApplication
- Route files: *Controller.java, *Resource.java
- To test: start the server first, then run Node.js HTTP tests
  Example server start: "mvn spring-boot:run" or "./gradlew bootRun"`;

        case "unknown":
        default:
            return `
SOURCE CODE CONTEXT: Unknown
- Analyze provided files to identify the web framework being used
- Look for route/endpoint definitions in any language
- Identify how the server starts and what port it listens on
- Create Node.js HTTP tests that connect to the running server`;
    }
}