# serve.ps1 - Serveur HTTP ultra-léger en PowerShell natif pour Suivi eKiKare
$port = 8000
$dir = "C:\Users\karel\.gemini\antigravity-ide\scratch\suivi-ekikare"

# S'assurer que le port est libéré ou intercepter les erreurs
try {
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://localhost:$port/")
    $listener.Start()
    Write-Output "Serveur Suivi eKiKare démarré sur http://localhost:$port/"
    Write-Output "Dossier servi : $dir"
    Write-Output "Appuyez sur Ctrl+C pour arrêter le serveur."
} catch {
    Write-Error "Impossible de démarrer le serveur sur le port $port. Il est peut-être déjà utilisé."
    exit 1
}

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        # Récupérer le chemin local du fichier demandé
        $urlPath = $request.Url.LocalPath
        if ($urlPath -eq "/" -or $urlPath -eq "") {
            $urlPath = "/index.html"
        }

        # Nettoyer et construire le chemin physique du fichier
        # Remplacer les slashes par des backslashes sous Windows
        $cleanPath = $urlPath.Replace("/", "\")
        if ($cleanPath.StartsWith("\")) {
            $cleanPath = $cleanPath.Substring(1)
        }
        $filePath = Join-Path $dir $cleanPath

        if (Test-Path $filePath -PathType Leaf) {
            try {
                $bytes = [System.IO.File]::ReadAllBytes($filePath)
                
                # Détecter le type MIME
                $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
                $contentType = "text/html; charset=utf-8"
                if ($ext -eq ".css") {
                    $contentType = "text/css; charset=utf-8"
                } elseif ($ext -eq ".js") {
                    # Important pour les modules ES6
                    $contentType = "application/javascript; charset=utf-8"
                } elseif ($ext -eq ".png") {
                    $contentType = "image/png"
                } elseif ($ext -eq ".jpg" -or $ext -eq ".jpeg") {
                    $contentType = "image/jpeg"
                } elseif ($ext -eq ".svg") {
                    $contentType = "image/svg+xml; charset=utf-8"
                } elseif ($ext -eq ".json") {
                    $contentType = "application/json; charset=utf-8"
                }

                # En-têtes HTTP
                $response.ContentType = $contentType
                $response.ContentLength64 = $bytes.Length
                $response.AddHeader("Access-Control-Allow-Origin", "*")
                $response.AddHeader("Cache-Control", "no-cache, no-store, must-revalidate")
                
                # Écriture de la réponse
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            } catch {
                $response.StatusCode = 500
                $errMsg = [System.Text.Encoding]::UTF8.GetBytes("Erreur interne du serveur lors de la lecture du fichier.")
                $response.OutputStream.Write($errMsg, 0, $errMsg.Length)
            }
        } else {
            $response.StatusCode = 404
            $notFoundMsg = [System.Text.Encoding]::UTF8.GetBytes("Fichier non trouvé : $urlPath")
            $response.OutputStream.Write($notFoundMsg, 0, $notFoundMsg.Length)
        }
        
        $response.Close()
    }
} catch {
    Write-Output "Arrêt du serveur."
} finally {
    $listener.Stop()
    $listener.Close()
}
