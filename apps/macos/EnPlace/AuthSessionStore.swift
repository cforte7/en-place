import Foundation
import Observation

@MainActor
@Observable
final class AuthSessionStore {
    enum State: Equatable {
        case loading
        case signedOut
        case signedIn(AuthenticatedUser)
    }

    private let keychain: KeychainSessionStore
    private let tokenProvider: SessionTokenProvider
    private let api: EnPlaceAPI
    private var didAttemptRestore = false

    private(set) var state: State = .loading
    private(set) var isWorking = false
    var errorMessage: String?

    init(
        serverURL: URL = URL(string: "http://127.0.0.1:3100")!,
        keychain: KeychainSessionStore = KeychainSessionStore()
    ) {
        let tokenProvider = SessionTokenProvider()
        self.keychain = keychain
        self.tokenProvider = tokenProvider
        api = EnPlaceAPI(serverURL: serverURL, tokenProvider: tokenProvider)
    }

    func restore() async {
        guard !didAttemptRestore else { return }
        didAttemptRestore = true
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }

        do {
            guard let token = try keychain.load() else {
                state = .signedOut
                return
            }

            await tokenProvider.setToken(token)
            state = .signedIn(try await api.currentUser())
        } catch APIClientError.unauthorized {
            await clearRejectedSession()
            state = .signedOut
        } catch {
            state = .signedOut
            errorMessage = "The saved session could not be restored. \(error.localizedDescription)"
        }
    }

    func signIn(email: String, password: String) async {
        guard !isWorking else { return }
        guard !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !password.isEmpty else {
            errorMessage = "Enter your email and password."
            return
        }

        await authenticate {
            try await api.login(email: email, password: password)
        }
    }

    func createAccount(email: String, password: String, displayName: String?) async {
        guard !isWorking else { return }
        guard !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !password.isEmpty else {
            errorMessage = "Enter your email and password."
            return
        }

        let normalizedDisplayName = displayName?.trimmingCharacters(in: .whitespacesAndNewlines)
        await authenticate {
            try await api.createAccount(
                email: email,
                password: password,
                displayName: normalizedDisplayName?.isEmpty == true ? nil : normalizedDisplayName
            )
        }
    }

    func signOut() async {
        guard !isWorking else { return }
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }

        var remoteError: Error?
        do {
            try await api.logout()
        } catch APIClientError.unauthorized {
            // The server has already rejected the session; local cleanup is sufficient.
        } catch {
            remoteError = error
        }

        do {
            try keychain.delete()
        } catch {
            errorMessage = "The local session could not be removed. \(error.localizedDescription)"
            return
        }

        await tokenProvider.setToken(nil)
        state = .signedOut

        if let remoteError {
            errorMessage = "Signed out on this Mac, but the server session could not be revoked. \(remoteError.localizedDescription)"
        }
    }

    func clearError() {
        errorMessage = nil
    }

    private func authenticate(_ request: () async throws -> AuthenticatedSession) async {
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }

        do {
            let session = try await request()
            await tokenProvider.setToken(session.token)

            do {
                try keychain.save(session.token)
            } catch {
                try? await api.logout()
                try? keychain.delete()
                await tokenProvider.setToken(nil)
                throw error
            }

            state = .signedIn(session.user)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func clearRejectedSession() async {
        await tokenProvider.setToken(nil)

        do {
            try keychain.delete()
        } catch {
            errorMessage = "The expired session could not be removed. \(error.localizedDescription)"
        }
    }
}
