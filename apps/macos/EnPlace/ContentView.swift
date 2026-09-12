//
//  ContentView.swift
//  EnPlace
//
//  Created by Christopher Forte on 9/9/26.
//

import SwiftUI

struct ContentView: View {
    @Bindable var authSession: AuthSessionStore

    var body: some View {
        Group {
            switch authSession.state {
            case .loading:
                ProgressView("Restoring your session…")
            case .signedOut:
                AuthenticationView(authSession: authSession)
            case .signedIn(let user):
                AuthenticatedAppView(user: user, authSession: authSession)
            }
        }
        .frame(minWidth: 440, minHeight: 340)
        .task {
            await authSession.restore()
        }
    }
}

private struct AuthenticationView: View {
    private enum Mode: String, CaseIterable, Identifiable {
        case signIn = "Sign In"
        case createAccount = "Create Account"

        var id: Self { self }
    }

    @Bindable var authSession: AuthSessionStore
    @State private var mode = Mode.signIn
    @State private var email = ""
    @State private var password = ""
    @State private var displayName = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 6) {
                Text("En Place")
                    .font(.largeTitle.weight(.semibold))
                Text("Sign in to continue.")
                    .foregroundStyle(.secondary)
            }

            Picker("Authentication mode", selection: $mode) {
                ForEach(Mode.allCases) { mode in
                    Text(mode.rawValue).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            VStack(spacing: 12) {
                if mode == .createAccount {
                    TextField("Display name (optional)", text: $displayName)
                        .textFieldStyle(.roundedBorder)
                }

                TextField("Email", text: $email)
                    .textFieldStyle(.roundedBorder)

                SecureField("Password", text: $password)
                    .textFieldStyle(.roundedBorder)
            }

            if let errorMessage = authSession.errorMessage {
                Text(errorMessage)
                    .font(.callout)
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel("Authentication error: \(errorMessage)")
            }

            HStack {
                Spacer()
                if authSession.isWorking {
                    ProgressView()
                        .controlSize(.small)
                }
                Button(mode.rawValue) {
                    Task {
                        switch mode {
                        case .signIn:
                            await authSession.signIn(email: email, password: password)
                        case .createAccount:
                            await authSession.createAccount(
                                email: email,
                                password: password,
                                displayName: displayName
                            )
                        }
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(authSession.isWorking)
            }
        }
        .padding(32)
        .frame(maxWidth: 420)
        .onChange(of: mode) {
            authSession.clearError()
        }
    }
}

