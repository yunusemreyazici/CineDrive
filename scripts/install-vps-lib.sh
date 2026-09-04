#!/usr/bin/env bash

# Pure validation and prompt helpers shared by the VPS installer and its tests.
# This file deliberately has no side effects when sourced.

validate_domain() {
  local domain="$1"
  local label
  local last_label
  local -a labels

  if [[ -z "$domain" || ${#domain} -gt 253 || "$domain" != *.* ||
    "$domain" == *$'\n'* || "$domain" == *$'\r'* ]]; then
    return 1
  fi

  IFS='.' read -r -a labels <<<"$domain"
  last_label="${labels[${#labels[@]} - 1]}"
  [[ "$last_label" =~ [A-Za-z] ]] || return 1

  for label in "${labels[@]}"; do
    if [[ ${#label} -lt 1 || ${#label} -gt 63 ]]; then
      return 1
    fi
    [[ "$label" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$ ]] || return 1
  done
}

validate_email() {
  local email="$1"
  [[ "$email" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]
}

validate_nginx_path() {
  local candidate="$1"

  # These paths are emitted into unquoted Nginx directives. Keep the accepted
  # alphabet intentionally narrow so whitespace and directive metacharacters
  # cannot change the generated configuration.
  [[ "$candidate" =~ ^/[A-Za-z0-9_./+:@=-]+$ ]] || return 1
  [[ "/$candidate/" != */../* ]]
}

validate_pnpm_version() {
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

prompt_yes_no() {
  local variable_name="$1"
  local prompt="$2"
  local default_answer="${3:-no}"
  local answer="${!variable_name:-}"
  local suffix='[y/N]'

  if [[ "$default_answer" == "yes" ]]; then
    suffix='[Y/n]'
  fi

  while true; do
    if [[ -z "$answer" ]]; then
      read -r -p "$prompt $suffix: " answer
    fi

    case "${answer,,}" in
      y | yes | e | evet | true | 1)
        printf -v "$variable_name" '%s' 'true'
        return 0
        ;;
      n | no | h | hayır | hayir | false | 0)
        printf -v "$variable_name" '%s' 'false'
        return 0
        ;;
      '')
        if [[ "$default_answer" == "yes" ]]; then
          printf -v "$variable_name" '%s' 'true'
        else
          printf -v "$variable_name" '%s' 'false'
        fi
        return 0
        ;;
      *)
        echo "Lütfen evet veya hayır yanıtı verin." >&2
        answer=''
        ;;
    esac
  done
}
