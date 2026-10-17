import { ACTIVE_APPLICATION_NATIVE } from './active-application-helper-native';

/** Fixed bundled code; executable policies are parsed as JSON stdin, never as script or arguments. */
export const ACTIVE_APPLICATION_HELPER_PS1 = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
${ACTIVE_APPLICATION_NATIVE}
'@
[Console]::Out.WriteLine('{"ready":true}')
while ($null -ne ($line = [Console]::ReadLine())) {
    if ([Text.Encoding]::UTF8.GetByteCount($line) -gt 131071) { exit 1 }
    $request = ConvertFrom-Json -InputObject $line
    $entries = @($request.entries)
    if ($entries.Count -gt 32 -or $request.id -le 0) { exit 1 }
    [string[]] $keys = @($entries | ForEach-Object { [string]$_.appKey })
    [string[]] $paths = @($entries | ForEach-Object { [string]$_.path })
    [bool[]] $denied = @($entries | ForEach-Object { [bool]$_.excluded })
    foreach ($path in $paths) { if ($path.Length -gt 1024 -or -not [IO.Path]::IsPathRooted($path)) { exit 1 } }
    [uint[]] $ownIds = @($request.ownProcessIds)
    if ($ownIds.Count -lt 1 -or $ownIds.Count -gt 512) { exit 1 }
    $sample = [WispActiveApplication]::Read($keys, $paths, $denied, $ownIds)
    if ($sample.available) {
        $response = @{ id=$request.id; available=$true; appKey=$sample.appKey; episodeToken=$sample.episodeToken;
            sourceToken=$sample.sourceToken; appName=$sample.appName; windowTitle=$sample.windowTitle }
    } else { $response = @{ id=$request.id; available=$false; reason=$sample.reason } }
    $json = ConvertTo-Json -InputObject $response -Compress
    if ([Text.Encoding]::UTF8.GetByteCount($json) -gt 4094) { exit 1 }
    [Console]::Out.WriteLine($json)
}
`;
