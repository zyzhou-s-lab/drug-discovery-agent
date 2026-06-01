### A. internet/API reachability (HTTP code; 000=fail) ###
  400  https://api.platform.opentargets.org/api/v4/graphql
  200  https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=ROCK1&format=json&pageSize=1
  200  https://www.ebi.ac.uk/gwas/rest/api/efoTraits?size=1
  200  https://rest.uniprot.org/uniprotkb/P53350.json
  200  https://www.ebi.ac.uk/chembl/api/data/target?limit=1&format=json
  200  https://string-db.org/api/json/version
  404  https://gtexportal.org/api/v2/dataset/tissueInfo
  000  https://api.genetics.opentargets.org/graphql

### B. shared /data top-level ###
total 8
drwxrwxr-x. 10 root   cgg   161 May 30 09:30 .
dr-xr-xr-x. 21 root   root  274 Apr 11 20:51 ..
drwxrwxr-x. 18 weiq1  cgg   331 Nov  4  2025 database
drwxr-xr-x. 30 root   root 4096 May 29 16:38 home
drwxr-xr-x.  5  10030 cgg    65 May 30 09:30 leif1
drwxrwx---.  6 weiq1  1008   79 May  6  2025 omniSeq
drwxrwxrwx. 13 zhouy1 cgg   190 May 28 21:10 projects
drwxr-xr-x.  3 slurm  cgg    30 May 23  2024 reference
drwxr-xr-x.  3 weiq1  cgg    27 Dec 27  2023 script
drwxrwxr-x. 22 weiq1  cgg  4096 Jan 26 12:38 software
--- genomics-ish dirs in /data (timeout 50, depth<=3) ---
/data/home/xuem1/scRNAseq
/data/home/xuem1/database
/data/home/weiq1/databases
/data/home/zhouy1/database_workshop
/data/home/xiw1/scRNAseq
/data/home/xiw1/database
/data/home/luoy1/database
/data/home/luoy1/scRNAseq
/data/home/fur1/scRNAseq
/data/home/panx1/databases
/data/home/liz1/alphagenome
/data/software/scRNAseq
/data/software/scRNAseq/cellranger-8.0.1
/data/software/scRNAseq/sratoolkit.3.1.1-centos_linux64
/data/software/scRNAseq/anaconda3
/data/software/scRNAseq/UMI-tools-1.1.6
/data/database
/data/database/hg19
/data/database/hg19/Bisulfite_Genome
/data/database/hg38
/data/database/hg38/Bisulfite_Genome
/data/database/Broad
/data/database/Broad/b37
/data/database/Broad/hg38
/data/database/Broad/hg19
/data/database/kg_phase3_20130502
/data/database/kg_phase3_20130502/annovar
/data/database/UKBioBank
/data/database/UKBioBank/UKBioBank
/data/database/databases20210723
/data/database/databases20210723/Cancer
/data/database/databases20210723/DRH
/data/database/databases20210723/DRKG
/data/database/databases20210723/GO
/data/database/databases20210723/GTEx
/data/database/databases20210723/HGNC
/data/database/databases20210723/KEGG
/data/database/databases20210723/L1000
/data/database/databases20210723/OMIM
/data/database/databases20210723/Predixcan

### C. zhouy1 home data dirs ###
/data1/home/zhouy1
/data1/home/zhouy1/.mozilla
/data1/home/zhouy1/.mozilla/extensions
/data1/home/zhouy1/.mozilla/plugins
/data1/home/zhouy1/.vscode-server
/data1/home/zhouy1/.vscode-server/cli
/data1/home/zhouy1/.vscode-server/extensions
/data1/home/zhouy1/.vscode-server/data
/data1/home/zhouy1/.vscode-server/bin
/data1/home/zhouy1/.cache
/data1/home/zhouy1/.cache/Microsoft
/data1/home/zhouy1/.cache/conda-anaconda-tos
/data1/home/zhouy1/.cache/conda
/data1/home/zhouy1/.cache/nvidia
/data1/home/zhouy1/.cache/mesa_shader_cache
/data1/home/zhouy1/.cache/ibus
/data1/home/zhouy1/.cache/evolution
/data1/home/zhouy1/.cache/gnome-software
/data1/home/zhouy1/.cache/flatpak
/data1/home/zhouy1/.cache/gstreamer-1.0
/data1/home/zhouy1/.cache/samba
/data1/home/zhouy1/.cache/fontconfig
/data1/home/zhouy1/.cache/gdown
/data1/home/zhouy1/.cache/google-vscode-extension
/data1/home/zhouy1/.cache/cloud-code
/data1/home/zhouy1/.cache/snakemake
/data1/home/zhouy1/.cache/matplotlib
/data1/home/zhouy1/.cache/R
/data1/home/zhouy1/.cache/genomepy
/data1/home/zhouy1/.cache/keops2.3
--- database_workshop ---
/data1/home/zhouy1/database_workshop:
INDEX.tsv
R语言UpSet图可视化教程.md
avsnp
cellfm
cellphonedb
dummy_gwas.csv
echoes_silenced_genes
embeddings
embeddings-20260130T070757Z-3-002.zip
gatk_ref
geneformer_config
go
ibd_gwas
ibd_scrna
kegg
mash_gwas
mash_liver_analysis
opentarget_25.03
personal_knowledge_base
perturb_datasets
tahoe_100m
update_index.sh

/data1/home/zhouy1/database_workshop/avsnp:
README.txt
chr1_pos_rsid.txt
hg19_avsnp147.txt.gz
hg19_avsnp147.txt.gz.tbi
hg38_avsnp150.txt.gz
hg38_avsnp150.txt.gz.tbi

/data1/home/zhouy1/database_workshop/cellfm:
BCC_GSE123813.h5ad
Cell_Lines.h5ad
DC.h5ad
GO_data
Gene_classification.h5ad
Heart.h5ad
HumanPBMC.h5ad

### D. discovery-relevant python libs (base env) ###
  OK    requests
  OK    pandas
  OK    numpy
  OK    scipy
  OK    scanpy
  OK    anndata
  MISS  gseapy
  MISS  mygene
  MISS  pybiomart
  OK    networkx
  OK    statsmodels
  MISS  Bio
  MISS  gget

### E. conda envs + sshpass availability ###

# conda environments:
#
base                 * /data1/home/zhouy1/software/miniconda
CellFM                 /data1/home/zhouy1/software/miniconda/envs/CellFM
PLP-FM                 /data1/home/zhouy1/software/miniconda/envs/PLP-FM
attention-is-all-you-need-pytorch   /data1/home/zhouy1/software/miniconda/envs/attention-is-all-you-need-pytorch
cellflow               /data1/home/zhouy1/software/miniconda/envs/cellflow
celloracle_env         /data1/home/zhouy1/software/miniconda/envs/celloracle_env
crisp_env              /data1/home/zhouy1/software/miniconda/envs/crisp_env
echoes-of-silenced-genes   /data1/home/zhouy1/software/miniconda/envs/echoes-of-silenced-genes
genefoemer             /data1/home/zhouy1/software/miniconda/envs/genefoemer
gperturb               /data1/home/zhouy1/software/miniconda/envs/gperturb
iRIGS                  /data1/home/zhouy1/software/miniconda/envs/iRIGS
r44                    /data1/home/zhouy1/software/miniconda/envs/r44
scgen                  /data1/home/zhouy1/software/miniconda/envs/scgen
sctenifold             /data1/home/zhouy1/software/miniconda/envs/sctenifold
tools                  /data1/home/zhouy1/software/miniconda/envs/tools
vid2txt                /data1/home/zhouy1/software/miniconda/envs/vid2txt

sshpass: /usr/bin/sshpass
DONE_SURVEY
