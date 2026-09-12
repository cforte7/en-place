import Foundation
import Security

struct KeychainSessionStore: Sendable {
    private let service = "dev.EnPlace.EnPlace"
    private let account = "session-token"

    func save(_ token: String) throws {
        let query = lookupQuery()
        let attributes: [String: Any] = [
            kSecValueData as String: Data(token.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]

        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess {
            return
        }

        guard updateStatus == errSecItemNotFound else {
            throw KeychainError(status: updateStatus)
        }

        var item = query
        item.merge(attributes) { _, newValue in newValue }
        let addStatus = SecItemAdd(item as CFDictionary, nil)

        guard addStatus == errSecSuccess else {
            throw KeychainError(status: addStatus)
        }
    }

    func load() throws -> String? {
        var query = lookupQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        if status == errSecItemNotFound {
            return nil
        }

        guard status == errSecSuccess else {
            throw KeychainError(status: status)
        }

        guard let data = result as? Data, let token = String(data: data, encoding: .utf8) else {
            throw KeychainError.invalidData
        }

        return token
    }

    func delete() throws {
        let status = SecItemDelete(lookupQuery() as CFDictionary)

        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError(status: status)
        }
    }

    private func lookupQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}

enum KeychainError: LocalizedError {
    case invalidData
    case operationFailed(OSStatus)

    init(status: OSStatus) {
        self = .operationFailed(status)
    }

    var errorDescription: String? {
        switch self {
        case .invalidData:
            "The saved session token is invalid."
        case .operationFailed(let status):
            SecCopyErrorMessageString(status, nil) as String? ?? "Keychain error \(status)."
        }
    }
}
