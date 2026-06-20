from setuptools import setup, find_packages

with open("requirements.txt") as f:
	install_requires = f.read().strip().split("\n")

from exeliq_crm import __version__ as version

setup(
	name="exeliq_crm",
	version=version,
	description="Exeliq CRM Dashboard",
	author="Exeliq Tech Solutions",
	author_email="info@exeliqsolutions.com",
	packages=find_packages(),
	zip_safe=False,
	include_package_data=True,
	install_requires=install_requires,
)
