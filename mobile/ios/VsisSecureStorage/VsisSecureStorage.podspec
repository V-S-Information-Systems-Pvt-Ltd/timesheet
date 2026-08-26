require "json"

package = JSON.parse(File.read(File.join(__dir__, "..", "..", "package.json")))

Pod::Spec.new do |s|
  s.name         = "VsisSecureStorage"
  s.version      = package["version"]
  s.summary      = "Keychain-backed secure storage for the VSIS mobile session."
  s.homepage     = "https://example.invalid/vsis-mobile"
  s.license      = { :type => "UNLICENSED" }
  s.authors      = { "VSIS" => "dev@vsis.example" }

  s.platforms    = { :ios => "15.1" }
  s.source       = { :path => "." }

  s.source_files = "ios/**/*.{h,m,mm}"

  if respond_to?(:install_modules_dependencies, true)
    install_modules_dependencies(s)
  else
    s.dependency "React-Core"
  end
end
