FROM ubuntu:24.04

RUN apt-get update && apt-get install -y \
    curl git nodejs npm python3 python3-pip \
    build-essential jq \
    && rm -rf /var/lib/apt/lists/*

# Install Ollama (default agent runtime)
RUN curl -fsSL https://ollama.com/install.sh | sh

RUN useradd -m -s /bin/bash agent
USER agent
WORKDIR /home/agent

# Create quicksand config directory
RUN mkdir -p /home/agent/.quicksand
