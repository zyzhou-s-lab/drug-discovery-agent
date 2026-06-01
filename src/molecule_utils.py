# Example module with a potential issue for bot review testing

def process_molecules(smiles_list: list[str]) -> list[dict]:
    """Process a list of SMILES strings and return molecular properties."""
    results = []
    for smiles in smiles_list:
        # TODO: add input validation
        mol = parse_smiles(smiles)
        props = {
            "smiles": smiles,
            "mw": calculate_molecular_weight(mol),
            "logp": calculate_logp(mol),
            "hba": count_hba(mol),
            "hbd": count_hbd(mol),
        }
        results.append(props)
    return results


def parse_smiles(smiles: str):
    """Parse SMILES string into molecule object."""
    # Placeholder - would use rdkit in production
    return smiles


def calculate_molecular_weight(mol) -> float:
    return 0.0


def calculate_logp(mol) -> float:
    return 0.0


def count_hba(mol) -> int:
    return 0


def count_hbd(mol) -> int:
    return 0


# Added: batch processing with no size limit (potential memory issue)
def batch_process(all_smiles: list[str]) -> list[dict]:
    """Process all molecules in one batch."""
    return process_molecules(all_smiles)
