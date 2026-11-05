//! What a phone needs to reach the hub on this PC (docs/user-guide/setup-home-hub.md): the
//! network type, the Windows firewall rules, and Tailscale. Checking needs no admin rights;
//! adding the rules asks Windows for them once.

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::error::{CommandError, CommandResult};

/// The same names as the user guide, so rules made by hand count too.
const RULE: &str = "Avchetan hub";
const TAILSCALE_RULE: &str = "Avchetan hub (Tailscale)";
const TAILSCALE_RANGE: &str = "100.64.0.0/10";

#[derive(Debug, Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NetworkProfile {
    name: String,
    /// `Private`, `Public` or `DomainAuthenticated`.
    category: String,
}

#[derive(Debug, Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HubNetwork {
    /// The networks this PC is on now, Tailscale's own excluded.
    networks: Vec<NetworkProfile>,
    rule: bool,
    tailscale_rule: bool,
    /// This PC's Tailscale address, when Tailscale is running.
    tailscale_address: Option<String>,
}

/// One PowerShell run that prints the facts as JSON. `port` is a number, so it can't inject.
fn check_script(port: u16) -> String {
    format!(
        "$ErrorActionPreference = 'SilentlyContinue'
$networks = @(Get-NetConnectionProfile | Where-Object {{ $_.InterfaceAlias -ne 'Tailscale' }} |
  ForEach-Object {{ @{{ name = [string]$_.Name; category = [string]$_.NetworkCategory }} }})
function Has-Rule($name) {{
  $rule = Get-NetFirewallRule -DisplayName $name | Where-Object {{ $_.Enabled -eq 'True' -and $_.Action -eq 'Allow' }}
  if (-not $rule) {{ return $false }}
  $ports = @($rule | Get-NetFirewallPortFilter | ForEach-Object {{ [string]$_.LocalPort }})
  return $ports -contains '{port}'
}}
$tailscale = Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias Tailscale | Select-Object -First 1
@{{
  networks = $networks
  rule = (Has-Rule '{RULE}')
  tailscaleRule = (Has-Rule '{TAILSCALE_RULE}')
  tailscaleAddress = if ($tailscale) {{ [string]$tailscale.IPAddress }} else {{ $null }}
}} | ConvertTo-Json -Compress -Depth 4"
    )
}

/// Replaces both rules, so a rule left on another port is fixed too.
fn allow_script(port: u16) -> String {
    format!(
        "Remove-NetFirewallRule -DisplayName '{RULE}' -ErrorAction SilentlyContinue
Remove-NetFirewallRule -DisplayName '{TAILSCALE_RULE}' -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName '{RULE}' -Direction Inbound -Protocol TCP -LocalPort {port} -Profile Private -Action Allow | Out-Null
New-NetFirewallRule -DisplayName '{TAILSCALE_RULE}' -Direction Inbound -Protocol TCP -LocalPort {port} -RemoteAddress {TAILSCALE_RANGE} -Action Allow | Out-Null"
    )
}

#[cfg(windows)]
fn powershell(script: &str) -> std::io::Result<std::process::Output> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
}

#[cfg(windows)]
#[tauri::command(async)]
pub fn hub_network_status(port: u16) -> CommandResult<HubNetwork> {
    let failed = |message: String| CommandError::new("network_check_failed", message);
    let output = powershell(&check_script(port)).map_err(|error| failed(error.to_string()))?;
    if !output.status.success() {
        return Err(failed(format!("PowerShell exited with {}", output.status)));
    }
    parse_status(&String::from_utf8_lossy(&output.stdout)).map_err(failed)
}

/// Windows' own prompt asks the user to approve; a refusal is `firewall_declined`.
#[cfg(windows)]
#[tauri::command(async)]
pub fn hub_network_allow(port: u16) -> CommandResult<()> {
    // The rule script goes through -EncodedCommand, so no quoting survives into the elevated shell.
    let encoded = encode_command(&allow_script(port));
    let launcher = format!(
        "try {{ $p = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','{encoded}'; exit $p.ExitCode }} catch {{ exit 1223 }}"
    );
    let output = powershell(&launcher)
        .map_err(|error| CommandError::new("firewall_failed", error.to_string()))?;
    match output.status.code() {
        Some(0) => Ok(()),
        // ERROR_CANCELLED: the user said no to Windows' prompt.
        Some(1223) => Err(CommandError::new(
            "firewall_declined",
            "Windows wasn't allowed to add the firewall rule",
        )),
        code => Err(CommandError::new(
            "firewall_failed",
            format!("Adding the firewall rule failed ({code:?})"),
        )),
    }
}

#[cfg(not(windows))]
#[tauri::command(async)]
pub fn hub_network_status(_port: u16) -> CommandResult<HubNetwork> {
    Err(CommandError::new(
        "network_check_unsupported",
        "Only on Windows for now",
    ))
}

#[cfg(not(windows))]
#[tauri::command(async)]
pub fn hub_network_allow(_port: u16) -> CommandResult<()> {
    Err(CommandError::new(
        "network_check_unsupported",
        "Only on Windows for now",
    ))
}

/// Windows Settings, where the user makes their home network Private.
#[tauri::command]
pub fn network_settings_open(app: AppHandle) -> CommandResult<()> {
    app.opener()
        .open_url("ms-settings:network-status", None::<&str>)
        .map_err(|error| CommandError::new("open_failed", error.to_string()))
}

fn parse_status(json: &str) -> Result<HubNetwork, String> {
    serde_json::from_str(json.trim()).map_err(|error| error.to_string())
}

/// PowerShell's -EncodedCommand takes base64 of UTF-16LE.
fn encode_command(script: &str) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = chunk
            .iter()
            .enumerate()
            .fold(0u32, |n, (i, &b)| n | (u32::from(b) << (16 - 8 * i)));
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(char::from(TABLE[(n >> (18 - 6 * i)) as usize & 63]));
            } else {
                out.push('=');
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_check_output() {
        let status = parse_status(
            r#"{"networks":[{"name":"Home","category":"Private"}],"rule":true,"tailscaleRule":false,"tailscaleAddress":"100.95.1.2"}"#,
        )
        .unwrap();
        assert_eq!(status.networks[0].category, "Private");
        assert!(status.rule && !status.tailscale_rule);
        assert_eq!(status.tailscale_address.as_deref(), Some("100.95.1.2"));
    }

    #[test]
    fn reads_a_pc_with_no_tailscale() {
        let status = parse_status(
            r#"{"networks":[],"rule":false,"tailscaleRule":false,"tailscaleAddress":null}"#,
        )
        .unwrap();
        assert_eq!(status.tailscale_address, None);
    }

    #[test]
    fn encodes_for_powershell() {
        // [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes('dir'))
        assert_eq!(encode_command("dir"), "ZABpAHIA");
        assert_eq!(encode_command("ab"), "YQBiAA==");
    }

    #[test]
    fn scripts_use_the_guide_rule_names_and_the_port() {
        let script = allow_script(8787);
        assert!(script.contains("-DisplayName 'Avchetan hub' -Direction Inbound -Protocol TCP -LocalPort 8787 -Profile Private"));
        assert!(script.contains("-RemoteAddress 100.64.0.0/10"));
        assert!(check_script(9000).contains("-contains '9000'"));
    }
}
