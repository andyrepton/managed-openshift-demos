.DEFAULT_GOAL := help

VIRTUALENV ?= "./virtualenv/"
ANSIBLE = $(VIRTUALENV)/bin/ansible-playbook

.PHONY: help
help:
	@echo GLHF

.PHONY: virtualenv
virtualenv:
	LC_ALL=en_US.UTF-8 python3 -m venv $(VIRTUALENV)
	. $(VIRTUALENV)/bin/activate
	pip install pip --upgrade
	LC_ALL=en_US.UTF-8 ./virtualenv/bin/pip3 install -r requirements.txt
	# ./virtualenv/bin/ansible-galaxy collection install azure.azcollection --force
	# ./virtualenv/bin/pip3 install -r ~/.ansible/collections/ansible_collections/azure/azcollection/requirements-azure.txt
	# ./virtualenv/bin/ansible-galaxy collection install community.okd

.PHONY: create.%
create.%:
	$(VIRTUALENV)/bin/ansible-playbook ./$*/playbook-create.yaml

.PHONY: delete.%
delete.%:
	$(VIRTUALENV)/bin/ansible-playbook ./$*/playbook-delete.yaml
