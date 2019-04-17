import React, { Component, Fragment } from 'react'
import { withRouter } from 'react-router'
import './App.css'
import axios from 'axios'
const Web3 = require('web3')

const API_URL = 'https://api.ethpkg.org'

const MAX_DONATION = 10
const MAIN_NETWORK_ID = '1'
const ROPSTEN_NETWORK_ID = '3'

const CURRENT_NETWORK = ROPSTEN_NETWORK_ID

const ethereum = window.web3 ? new Web3(window.web3.currentProvider) : (window.ethereum ? new Web3(window.ethereum) : null)
window.__ethereum = ethereum

const copyToClipboard = str => {
  const el = document.createElement('textarea');
  el.value = str;
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
}

class App extends Component {
  state={
    address: undefined,
    packageName: undefined,
    error: undefined,
    isLoading: false,
    verificationResult: null,
    donationAmount: 3,
    etherPriceUsd: 0,
    donationError: '',
    txHash: ''
  }
  componentDidMount = () => {
    const { location } = this.props
    const { pathname } = location
    const parts = pathname.split('/')
    parts.shift() // remove empty "" first element
    let packageName
    if (parts.length === 3) {
      packageName = `${parts[1]}/${parts[2]}`
    } else if (parts.length === 2) {
      packageName = parts[1]
    }
    this.setState({packageName})
    if (packageName) {
      this.verifyPackage(packageName)
    }

    this.getPrice().catch(err => console.log(err))
  }
  getPrice = async () => {
    const response = await axios.get('https://api.coinbase.com/v2/prices/ETH-USD/buy')
    const payload = response.data
    const { data } = payload
    let price = data.amount // in usd
    price = parseFloat(price)
    this.setState({
      etherPriceUsd: price
    })
  }
  verifyPackage = async (packageName) => {
    this.setState({
      isLoading: true
    })
    try {
      const response = await axios.get(`${API_URL}/verify/npm/${packageName}`)
      const {data} = response
      const {verificationResult, pkgJson: pkgInfo}  = data
      this.setState({
        isLoading: false,
        verificationResult,
        pkgInfo
      })

      if(verificationResult && verificationResult.signers) {
        const signer = verificationResult.signers[0]
        const { address } = signer
        this.setState({
          address
        }) 
      }
      
    } catch (error) {
      this.setState({
        error: error.message,
        isLoading: false
      })
    }
  }
  handleDonationClicked = async () => {

    // reset errors
    this.setState({
      donationError: ''
    })

    if (!ethereum) {
      alert('Please use a Dapp browser like Opera, Status or install the Metamask extension')
      return
    }

    // somehow await ethereum.sendAsync is not working properly
    // FIXME To be superceded by the promise-returning send() method in EIP 1193.
    const sendAsync = (args) => new Promise((resolve, reject) => {
      let _sendAsync = null
      if (window.web3) {
        _sendAsync = window.web3.currentProvider.sendAsync
      }
      else if (window.ethereum) {
        _sendAsync = window.ethereum.sendAsync
      } else {
        _sendAsync = ethereum.currentProvider.sendAsync
      }
      _sendAsync(args, (err, response) => {
        if(err) return reject(err)
        return resolve(response)
      })
    })

    const getAccounts = async () => {
     
      // try deprecated enable()
      if (window.ethereum) {
        if( typeof window.ethereum.enable === 'function') {
          try {
            const accounts = await window.ethereum.enable()
            if (accounts) {
              return accounts
            } // else opera not returning accounts? - ignore :(
          } catch (error) {
            // Handle error. Likely the user rejected the login:
            if (error.message === "User rejected provider access") {
              throw error
            }
            // ignore ?
            console.log('1 getAccounts error', error)
          }
        }
      }  

      try {
        const accounts = await ethereum.eth.requestAccounts()
        return accounts
      } catch (error) {
        console.log('4 getAccounts error', error)
      }

      try {
        const response = await sendAsync({
          "jsonrpc":"2.0",
          "method":"eth_accounts",
          "params":[],
          "id":1
        })
        if (response && response.result) {
          return response.result
        }
      } catch (error) {
          console.log('5 getAccounts error', error)
      }

    }

    const toWei = (num, unit) => {
      return ethereum.utils.toHex(ethereum.utils.toWei(num.toString(), unit))
    }

    const { etherPriceUsd, donationAmount, address: to } = this.state

    if (!to) {
      return this.renderDonationError('Author address not found or malformed')
    }

    try {

      let accounts = await getAccounts()

      // opera for example does not return accounts with enable()
      // try fallback:
      if (!accounts || accounts.length <= 0) {
        return this.renderDonationError('Accounts could not be retrieved')
      }

      const from = accounts[0]
      const desiredNetwork = CURRENT_NETWORK
      if (!ethereum.networkVersion) {
        // TODO
      } else {
        if (ethereum.networkVersion !== desiredNetwork) {
          const networkName = desiredNetwork === MAIN_NETWORK_ID ? 'Main' : 'Ropsten test'
          return this.renderDonationError(`This application requires the ${networkName} network, please switch it in your MetaMask UI.`)
        }
      }

      // convert user-selected usd amount to eth
      const usdToEth = 1 / etherPriceUsd
      const donationInEth = usdToEth * donationAmount
      
      // security check
      if (donationInEth > 0.5 || donationInEth > (MAX_DONATION * usdToEth)) {
        return this.renderDonationError('Your donation seems suspiciously large')
      }

      // convenience check without popup
      try {
        if (CURRENT_NETWORK === MAIN_NETWORK_ID) {
          let balance = await ethereum.getBalance(from)
          let balanceEth = parseFloat(ethereum.utils.fromWei(balance, "ether"))
          if (balanceEth < donationInEth) {
            return this.renderDonationError('Insufficient funds')
          }
        }
      } catch (err) {
        // ignored: metamask has built in feedback
      }

      // convert eth amount to wei
      const valueWei = toWei(donationInEth, 'ether').toString('hex')

      // create tx data
      const transactionParameters = {
        from, // must match user's active address.
        to, // Required except during contract publications.
        value: valueWei, // Only required to send ether to the recipient from the initiating external account.
      }

      // try to submit tx to network
      const response = await sendAsync({
        method: 'eth_sendTransaction',
        params: [transactionParameters],
        from
      })

      if (!response) {
        return this.renderDonationError('Metamask did not not return a valid response object')
      }

      const rejected = 'User denied transaction signature.'
      if (response && response.error) {
        if (response.error.message.includes(rejected)) {
          return this.renderDonationError(`Cannot send money without your permission.`)
        } else {
          return this.renderDonationError(response.error)
        }
      }

      if (response.result) {
        // If there is a response.result, the call was successful.
        // In the case of this method, it is a transaction hash.
        const txHash = response.result
        this.setState({
          txHash
        })
        this.renderDonationSuccess('Thank you for your donation!')
  
        // You can poll the blockchain to see when this transaction has been mined:
        // pollForCompletion(txHash, callback)
      } else {
        this.renderDonationError('the tx result is malformed')
      }
      
    } catch (err) {
      console.log('donation error', err)
      return this.renderDonationError('There was an issue, please try again:' + err)
    }
  }
  renderDonationError = (donationError) => {
    this.setState({
      donationError
    })
  }
  renderDonationSuccess = (msg) => {
    alert(msg)
  }
  renderVerificationResult = () => {
    return (
      <div></div>
    )
  }
  renderWarning = () => {
    console.log('warning warning')
  }
  renderPackageNotFound = () => {
    return (
      <Fragment>
        <h1 className="title">Package not found</h1>
      </Fragment>
    )
  }
  renderTopNav = () => {
    return (
    <div className="hero-head">
      <nav className="navbar">
        <div className="container">
          <div className="navbar-brand">
            <a className="navbar-item">
              <img src="https://github.com/PhilippLgh/ethereum-signed-packages/raw/master/assets/ethpkg_logo.png" alt="Logo" style={{paddingRight: 10}}/>
              <span>Ethereum Signed Packages</span>
              <span className="tag" style={{color: 'tomato'}}><strong>ALPHA</strong></span>
            </a>
          </div>
          <div id="navbarMenuHeroA" className="navbar-menu">
            <div className="navbar-end">
              <span className="navbar-item">
              {/*
                <a className="nav-link is-primary is-inverted">
                  <span className="icon">
                    <i className="fab fa-discord"></i>
                  </span>
                  <span>chat</span>
                </a>
                <a className="nav-link is-primary is-inverted">
                  <span className="icon">
                    <i className="fab fa-twitter"></i>
                  </span>
                  <span>@ethpkg</span>
                </a>
              */}
                <a className="nav-link is-primary is-inverted" href="https://github.com/PhilippLgh/ethereum-signed-packages" target="_blank">
                  <span className="icon">
                    <i className="fab fa-github"></i>
                  </span>
                  <span>ethpkg</span>
                </a>
                <a className="nav-link is-primary is-inverted" href="mailto://philipp+ethpkg@ethereum.org" >
                  <span className="icon">
                    <i className="fas fa-envelope"></i>
                  </span>
                  <span>ethpkg</span>
                </a>
              </span>
            </div>
          </div>
        </div>
      </nav>
    </div>
    )
  }
  renderLoading = () => {
    return (
      <div>
        <h1 className="title">Loading Package Info</h1>
        <i className="fas fa-spinner fa-spin" style={{fontSize: '3rem'}} />
      </div>
    )
  }
  changeDonationAmount = (val) => {
    this.setState({
      donationAmount: val
    })
  }
  renderDonationTags = () => {
    const { donationAmount } = this.state
    return (
    <div>
      <div className="tags" style={{display: 'inline', lineHeight: '2.7rem', fontSize: '1.5rem'}}>
        <span className={"tag is-white " + (donationAmount === 1 ? 'is-outlined' : '')} onClick={() => this.changeDonationAmount(1)}>1 USD</span>
        <span className={"tag is-white " + (donationAmount === 3 ? 'is-outlined' : '')} onClick={() => this.changeDonationAmount(3)}>3 USD</span>
        <span className={"tag is-white " + (donationAmount === 5 ? 'is-outlined' : '')} onClick={() => this.changeDonationAmount(5)}>5 USD</span>
        <span className={"tag is-white " + (donationAmount === 10 ? 'is-outlined' : '')} onClick={() => this.changeDonationAmount(10)}>10 USD</span>
      </div>
      <div>
        <span style={{fontSize: '0.75rem'}}>*conversion rates based on coinbase real-time data</span>
      </div>
    </div>
    )
  }
  copyBadgeMarkdown = () => {
    const { packageName } = this.state
    const markdown = `[![ethpkg status](http://api.ethpkg.org/badge/npm/${packageName})](http://ethpkg.org/npm/${packageName})`
    copyToClipboard(markdown)
  }
  renderPackageInfo = (packageName) => {
    const { verificationResult, pkgInfo, donationError, txHash } = this.state
    const canDonate = verificationResult && verificationResult.isValid === true
    const packageVersion = (pkgInfo && pkgInfo.version) || 'no version'
    return (
      <Fragment>
      <h1 className="title">
      {packageName} <span className="tag is-dark">{packageVersion}</span> 
      </h1>
      <img src={`${API_URL}/badge/npm/${packageName}`} /> <button className="button is-small" onClick={this.copyBadgeMarkdown}>copy markdown</button>
      <div className="donation-select" style={{marginTop: 30}}>
        { canDonate 
          ? this.renderDonationTags() 
          : (
          <article className="message is-danger">
            <div className="message-body">
              <strong>Unsigned packages cannot receive donations</strong>
              <p>
                The transaction address is derived from the package signature but no package or signature was found. <br/>
              </p> 
              Without this address the transaction cannot be sent.
            </div>
            <a href="https://github.com/PhilippLgh/ethereum-signed-packages#quickstart" target="_blank">sign your packages now</a>
          </article>
          )
        }
        <div>
        </div>
        <div>
          <div style={{marginTop: 25}}>
            <a className="button is-medium is-primary is-outlined" disabled={!canDonate} onClick={canDonate ? this.handleDonationClicked : () => {}}>DONATE</a>
          </div>
          {donationError && (
          <div style={{marginTop: 40}}>
            <strong style={{color:"tomato"}}>
              <i className="fas fa-exclamation-circle" style={{marginRight: 5}}></i>
              {donationError}
            </strong>
          </div>
          )}
          {txHash && (
            <div style={{marginTop: 40}}>
              <strong style={{color:"teal"}}>
                <i className="fas fa-check" style={{marginRight: 5}}></i>
                Processing your transaction: {txHash}
              </strong>
            </div>
          )}
        </div>
      </div>
      </Fragment>
    )
  }
  render() {
    const { packageName, isLoading } = this.state
    return (
      <Fragment>
      <section className="hero is-light is-medium">
        {this.renderTopNav()}
        <div className="hero-body">
          <div className="container has-text-centered">
            {isLoading
            ? this.renderLoading()
            : packageName? this.renderPackageInfo(packageName) : this.renderPackageNotFound()
            }
          </div>
        </div>
      </section>
      </Fragment>
    )
  }
}

export default withRouter(App);
