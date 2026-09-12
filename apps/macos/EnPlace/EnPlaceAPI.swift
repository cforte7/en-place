import Foundation
import HTTPTypes
import OpenAPIRuntime
import OpenAPIURLSession

struct AuthenticatedUser: Equatable, Sendable {
    let id: String
    let email: String
    let displayName: String?
    let emailVerifiedAt: Date?
    let createdAt: Date
    let updatedAt: Date
}

struct AuthenticatedSession: Sendable {
    let token: String
    let expiresAt: Date
    let user: AuthenticatedUser
}

actor SessionTokenProvider {
    private var token: String?

    func setToken(_ token: String?) {
        self.token = token
    }

    func currentToken() -> String? {
        token
    }
}

struct BearerAuthenticationMiddleware: ClientMiddleware {
    let tokenProvider: SessionTokenProvider

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        guard let token = await tokenProvider.currentToken() else {
            return try await next(request, body, baseURL)
        }

        var request = request
        request.headerFields[.authorization] = "Bearer \(token)"
        return try await next(request, body, baseURL)
    }
}

struct EnPlaceAPI: Sendable {
    private let client: Client

    init(serverURL: URL, tokenProvider: SessionTokenProvider) {
        client = Client(
            serverURL: serverURL,
            configuration: .init(dateTranscoder: .iso8601WithFractionalSeconds),
            transport: URLSessionTransport(),
            middlewares: [BearerAuthenticationMiddleware(tokenProvider: tokenProvider)]
        )
    }

    func createAccount(email: String, password: String, displayName: String?) async throws -> AuthenticatedSession {
        let output = try await client.createUser(
            body: .json(.init(email: email, password: password, displayName: displayName))
        )

        switch output {
        case .created(let response):
            let payload = try response.body.json
            return AuthenticatedSession(
                token: payload.sessionToken,
                expiresAt: payload.expiresAt,
                user: AuthenticatedUser(payload.user)
            )
        case .badRequest:
            throw APIClientError.invalidRequest
        case .conflict:
            throw APIClientError.emailTaken
        case .internalServerError:
            throw APIClientError.serverError
        case .undocumented(let statusCode, _):
            throw APIClientError.unexpectedStatus(statusCode)
        }
    }

    func login(email: String, password: String) async throws -> AuthenticatedSession {
        let output = try await client.login(
            body: .json(.init(email: email, password: password))
        )

        switch output {
        case .ok(let response):
            let payload = try response.body.json
            return AuthenticatedSession(
                token: payload.sessionToken,
                expiresAt: payload.expiresAt,
                user: AuthenticatedUser(payload.user)
            )
        case .badRequest:
            throw APIClientError.invalidRequest
        case .unauthorized:
            throw APIClientError.invalidCredentials
        case .internalServerError:
            throw APIClientError.serverError
        case .undocumented(let statusCode, _):
            throw APIClientError.unexpectedStatus(statusCode)
        }
    }

    func currentUser() async throws -> AuthenticatedUser {
        let output = try await client.getCurrentUser()

        switch output {
        case .ok(let response):
            return AuthenticatedUser(try response.body.json)
        case .unauthorized:
            throw APIClientError.unauthorized
        case .internalServerError:
            throw APIClientError.serverError
        case .undocumented(let statusCode, _):
            throw APIClientError.unexpectedStatus(statusCode)
        }
    }

    func logout() async throws {
        let output = try await client.logout()

        switch output {
        case .noContent:
            return
        case .unauthorized:
            throw APIClientError.unauthorized
        case .internalServerError:
            throw APIClientError.serverError
        case .undocumented(let statusCode, _):
            throw APIClientError.unexpectedStatus(statusCode)
        }
    }
}

private extension AuthenticatedUser {
    init(_ payload: Operations.CreateUser.Output.Created.Body.JsonPayload.UserPayload) {
        self.init(
            id: payload.id,
            email: payload.email,
            displayName: payload.displayName,
            emailVerifiedAt: payload.emailVerifiedAt,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt
        )
    }

    init(_ payload: Operations.Login.Output.Ok.Body.JsonPayload.UserPayload) {
        self.init(
            id: payload.id,
            email: payload.email,
            displayName: payload.displayName,
            emailVerifiedAt: payload.emailVerifiedAt,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt
        )
    }

    init(_ payload: Operations.GetCurrentUser.Output.Ok.Body.JsonPayload) {
        self.init(
            id: payload.id,
            email: payload.email,
            displayName: payload.displayName,
            emailVerifiedAt: payload.emailVerifiedAt,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt
        )
    }
}

enum APIClientError: LocalizedError, Equatable {
    case invalidRequest
    case emailTaken
    case invalidCredentials
    case unauthorized
    case serverError
    case unexpectedStatus(Int)

    var errorDescription: String? {
        switch self {
        case .invalidRequest:
            "The request is invalid."
        case .emailTaken:
            "An account with this email already exists."
        case .invalidCredentials:
            "The email or password is incorrect."
        case .unauthorized:
            "Your session has expired. Please sign in again."
        case .serverError:
            "The server could not complete the request."
        case .unexpectedStatus(let status):
            "The server returned an unexpected status (\(status))."
        }
    }
}
