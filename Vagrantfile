# This guide is optimized for Vagrant 1.7 and above.
# Although versions 1.6.x should behave very similarly, it is recommended
# to upgrade instead of disabling the requirement below.
Vagrant.require_version ">= 1.7.0"

Vagrant.configure(2) do |config|

  config.vm.box = "bento/centos-7.5" # 6.7" # "puphpet/centos65-x64" # "centos/7" #

  # Disable the new default behavior introduced in Vagrant 1.7, to
  # ensure that all Vagrant machines will use the same SSH key pair.
  # See https://github.com/mitchellh/vagrant/issues/5005
  config.ssh.insert_key = false

  # Synced folders
  config.vm.synced_folder ".", "/vagrant"

  # Configure guest services to be accessible on host
  config.vm.network "forwarded_port", guest: 3000, host: 3000
  # PostgreSQL
  config.vm.network "forwarded_port", guest: 5432, host: 5433 # host has postgres installed at 5432
  # MongoDB
  config.vm.network "forwarded_port", guest: 27017, host: 27018

  # If you need to boot via GUI mode because:
  # default: Warning: Remote connection disconnect. Retrying...
  # default: Warning: Remote connection disconnect. Retrying...
  # default: Warning: Remote connection disconnect. Retrying...
  # config.vm.provider :virtualbox do |vb|
  #   vb.gui = true
  # end

  config.vm.provider "virtualbox" do |v|
    v.memory = 4096
    # v.cpus = 2
  end

  config.vm.hostname = "session-tracker-api"

  # slow networking fix
  # https://github.com/mitchellh/vagrant/issues/1807
  config.vm.provider :virtualbox do |vb|
    vb.customize ["modifyvm", :id, "--natdnshostresolver1", "on"]
    vb.customize ["modifyvm", :id, "--natdnsproxy1", "on"]
  end

  config.vm.provision "ansible" do |ansible|
    ansible.verbose = "v"
    ansible.playbook = "playbook.dev.yml"
  end
end
