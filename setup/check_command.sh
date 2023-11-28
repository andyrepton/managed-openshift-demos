#!/bin/bash

# Function to check if a command is installed
check_command() {
    command -v $1 >/dev/null 2>&1 || { echo >&2 "Error: $1 is not installed. Please install it."; exit 1; }
}

check_command $1
