//
//  EnPlaceApp.swift
//  EnPlace
//
//  Created by Christopher Forte on 9/9/26.
//

import SwiftUI

@main
struct EnPlaceApp: App {
    @State private var authSession = AuthSessionStore()

    var body: some Scene {
        WindowGroup {
            ContentView(authSession: authSession)
        }
    }
}
