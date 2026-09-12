import SwiftUI

struct AuthenticatedAppView: View {
    private enum Destination: String, CaseIterable, Hashable, Identifiable {
        case home
        case account

        var id: Self { self }

        var title: String {
            switch self {
            case .home:
                "Home"
            case .account:
                "Account"
            }
        }

        var systemImage: String {
            switch self {
            case .home:
                "house"
            case .account:
                "person.crop.circle"
            }
        }
    }

    let user: AuthenticatedUser
    @Bindable var authSession: AuthSessionStore
    @State private var selection: Destination? = .home
    @State private var columnVisibility: NavigationSplitViewVisibility = .all

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            List(Destination.allCases, selection: $selection) { destination in
                Label(destination.title, systemImage: destination.systemImage)
                    .tag(destination)
            }
            .listStyle(.sidebar)
            .navigationTitle("En Place")
            .navigationSplitViewColumnWidth(min: 180, ideal: 220, max: 280)
        } detail: {
            destinationView
                .navigationTitle((selection ?? .home).title)
        }
        .navigationSplitViewStyle(.balanced)
        .frame(minWidth: 760, minHeight: 500)
    }

    @ViewBuilder
    private var destinationView: some View {
        switch selection ?? .home {
        case .home:
            HomeView(user: user)
        case .account:
            AccountView(user: user, authSession: authSession)
        }
    }
}

private struct HomeView: View {
    let user: AuthenticatedUser

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Welcome\(user.displayName.map { ", \($0)" } ?? "")")
                        .font(.largeTitle.weight(.semibold))
                    Text("You are signed in to En Place.")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                }

                GroupBox {
                    LabeledContent("Email", value: user.email)
                        .padding(.vertical, 4)
                } label: {
                    Label("Current Session", systemImage: "checkmark.shield")
                }
            }
            .frame(maxWidth: 680, alignment: .leading)
            .padding(32)
        }
    }
}

private struct AccountView: View {
    let user: AuthenticatedUser
    @Bindable var authSession: AuthSessionStore

    var body: some View {
        Form {
            Section("Profile") {
                LabeledContent("Display name", value: user.displayName ?? "Not set")
                LabeledContent("Email", value: user.email)
                LabeledContent("Email verification") {
                    if let emailVerifiedAt = user.emailVerifiedAt {
                        Text(emailVerifiedAt, format: .dateTime.month().day().year())
                    } else {
                        Text("Not verified")
                            .foregroundStyle(.secondary)
                    }
                }
                LabeledContent("Member since") {
                    Text(user.createdAt, format: .dateTime.month().day().year())
                }
            }

            if let errorMessage = authSession.errorMessage {
                Section {
                    Text(errorMessage)
                        .foregroundStyle(.red)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Section {
                HStack {
                    Button("Sign Out", role: .destructive) {
                        Task {
                            await authSession.signOut()
                        }
                    }
                    .disabled(authSession.isWorking)

                    if authSession.isWorking {
                        ProgressView()
                            .controlSize(.small)
                    }
                }
            }
        }
        .formStyle(.grouped)
    }
}
